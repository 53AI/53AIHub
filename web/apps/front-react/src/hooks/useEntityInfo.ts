import { useState, useCallback, useRef } from 'react'
import { userApi } from '@/api/modules/user'
import { groupApi } from '@/api/modules/group'
import { GROUP_TYPE } from '@/constants/group'
import {
  ENTITY_TYPE,
  type EntityType,
  type UserInfo,
  type GroupInfo,
  type EntityInfo
} from '@/types/entity'

const INTERNAL_USER_STATUS_ALL = -1

// 缓存管理
const entityCache = new Map<string, { data: EntityInfo[]; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5分钟

// Pending requests for deduplication
const pendingRequests = new Map<string, Promise<EntityInfo[]>>()

const getFromCache = (key: string): EntityInfo[] | null => {
  const cached = entityCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }
  return null
}

const setCache = (key: string, data: EntityInfo[]) => {
  entityCache.set(key, { data, timestamp: Date.now() })
}

/**
 * 统一实体信息管理 Hook
 * 提供用户和群组信息获取和缓存功能
 */
export function useEntityInfo() {
  const [loading, setLoading] = useState(false)

  /**
   * 获取所有用户列表（带缓存）
   */
  const getAllUsers = useCallback(async (): Promise<UserInfo[]> => {
    const cacheKey = 'all_users_list'

    // 检查缓存
    const cached = getFromCache(cacheKey)
    if (cached) return cached as UserInfo[]

    // 检查是否有进行中的请求
    if (pendingRequests.has(cacheKey)) {
      return pendingRequests.get(cacheKey) as Promise<UserInfo[]>
    }

    const request = (async () => {
      setLoading(true)
      try {
        const params = {
          status: INTERNAL_USER_STATUS_ALL as typeof INTERNAL_USER_STATUS_ALL,
          offset: 0,
          limit: 10000
        }

        const res = await userApi.fetch_internal_user(params)
        const users = res.list.map(
          (item: Record<string, unknown>): UserInfo => ({
            user_id: Number(item.user_id) || 0,
            nickname: String(item.nickname || item.name || ''),
            name: String(item.name || ''),
            avatar: String(item.avatar || ''),
            email: String(item.email || ''),
            mobile: String(item.mobile || ''),
            role: Number(item.role) || 1,
            status: Number(item.status) || 1,
            departments: Array.isArray(item.departments) ? item.departments : [],
            created_time: Number(item.created_time) || 0,
            value: Number(item.user_id) || 0,
            label: String(item.nickname || item.name || '')
          })
        )

        setCache(cacheKey, users)
        return users
      } catch (error) {
        console.error('获取用户列表失败:', error)
        return []
      } finally {
        setLoading(false)
        pendingRequests.delete(cacheKey)
      }
    })()

    pendingRequests.set(cacheKey, request)
    return request
  }, [])

  /**
   * 获取所有群组列表（带缓存）
   */
  const getAllGroups = useCallback(async (): Promise<GroupInfo[]> => {
    const cacheKey = 'all_groups_list'

    // 检查缓存
    const cached = getFromCache(cacheKey)
    if (cached) return cached as GroupInfo[]

    // 检查是否有进行中的请求
    if (pendingRequests.has(cacheKey)) {
      return pendingRequests.get(cacheKey) as Promise<GroupInfo[]>
    }

    const request = (async () => {
      setLoading(true)
      try {
        const res = await groupApi.list({ params: { group_type: GROUP_TYPE.INTERNAL_USER } })
        const groups = (res as unknown as Record<string, unknown>[]).map(
          (item): GroupInfo => ({
            group_id: Number(item.group_id) || 0,
            group_name: String(item.group_name || ''),
            sort: Number(item.sort) || 0,
            value: Number(item.group_id) || 0,
            label: String(item.group_name || ''),
            avatar: String(item.avatar || '')
          })
        )

        setCache(cacheKey, groups)
        return groups
      } catch (error) {
        console.error('获取群组列表失败:', error)
        return []
      } finally {
        setLoading(false)
        pendingRequests.delete(cacheKey)
      }
    })()

    pendingRequests.set(cacheKey, request)
    return request
  }, [])

  /**
   * 根据类型获取所有实体列表
   */
  const getAllEntities = useCallback(
    async (type: EntityType): Promise<EntityInfo[]> => {
      switch (type) {
        case ENTITY_TYPE.USER:
          return getAllUsers()
        case ENTITY_TYPE.GROUP:
          return getAllGroups()
        default:
          return []
      }
    },
    [getAllUsers, getAllGroups]
  )

  /**
   * 获取用户信息（从缓存的用户列表中查找）
   */
  const getUserInfo = useCallback(
    async (userId: number): Promise<UserInfo | null> => {
      if (!userId) return null

      try {
        const allUsers = await getAllUsers()
        const user = allUsers.find((item: UserInfo) => +item.user_id === +userId)
        return user || null
      } catch (error) {
        console.error('获取用户信息失败:', error)
        return null
      }
    },
    [getAllUsers]
  )

  /**
   * 获取群组信息（从缓存的群组列表中查找）
   */
  const getGroupInfo = useCallback(
    async (groupId: number): Promise<GroupInfo | null> => {
      if (!groupId) return null

      try {
        const allGroups = await getAllGroups()
        const group = allGroups.find((item: GroupInfo) => +item.group_id === +groupId)
        return group || null
      } catch (error) {
        console.error('获取群组信息失败:', error)
        return null
      }
    },
    [getAllGroups]
  )

  /**
   * 统一获取实体信息
   */
  const getEntityInfo = useCallback(
    async (type: EntityType, id: number): Promise<EntityInfo | null> => {
      switch (type) {
        case ENTITY_TYPE.USER:
          return getUserInfo(id)
        case ENTITY_TYPE.GROUP:
          return getGroupInfo(id)
        default:
          return null
      }
    },
    [getUserInfo, getGroupInfo]
  )

  /**
   * 批量获取用户信息
   */
  const getBatchUserInfo = useCallback(
    async (userIds: number[]): Promise<UserInfo[]> => {
      if (!userIds.length) return []

      try {
        const allUsers = await getAllUsers()
        const users = allUsers.filter((item: UserInfo) =>
          userIds.includes(+item.user_id)
        )
        return users
      } catch (error) {
        console.error('批量获取用户信息失败:', error)
        return []
      }
    },
    [getAllUsers]
  )

  /**
   * 批量获取群组信息
   */
  const getBatchGroupInfo = useCallback(
    async (groupIds: number[]): Promise<GroupInfo[]> => {
      if (!groupIds.length) return []

      try {
        const allGroups = await getAllGroups()
        const groups = allGroups.filter((item: GroupInfo) =>
          groupIds.includes(+item.group_id)
        )
        return groups
      } catch (error) {
        console.error('批量获取群组信息失败:', error)
        return []
      }
    },
    [getAllGroups]
  )

  /**
   * 批量获取实体信息
   */
  const getBatchEntityInfo = useCallback(
    async (type: EntityType, ids: number[]): Promise<EntityInfo[]> => {
      switch (type) {
        case ENTITY_TYPE.USER:
          return getBatchUserInfo(ids)
        case ENTITY_TYPE.GROUP:
          return getBatchGroupInfo(ids)
        default:
          return []
      }
    },
    [getBatchUserInfo, getBatchGroupInfo]
  )

  /**
   * 清除实体信息缓存
   */
  const clearEntityCache = useCallback((type?: EntityType) => {
    if (type) {
      const cacheKey = type === ENTITY_TYPE.USER ? 'all_users_list' : 'all_groups_list'
      entityCache.delete(cacheKey)
      pendingRequests.delete(cacheKey)
    } else {
      entityCache.clear()
      pendingRequests.clear()
    }
  }, [])

  /**
   * 清除用户信息缓存（兼容性方法）
   */
  const clearUserCache = useCallback(() => {
    clearEntityCache(ENTITY_TYPE.USER)
  }, [clearEntityCache])

  /**
   * 清除群组信息缓存（兼容性方法）
   */
  const clearGroupCache = useCallback(() => {
    clearEntityCache(ENTITY_TYPE.GROUP)
  }, [clearEntityCache])

  return {
    // 状态
    loading,

    // 统一方法
    getEntityInfo,
    getBatchEntityInfo,
    getAllEntities,
    clearEntityCache,

    // 用户相关方法（兼容性）
    getUserInfo,
    getBatchUserInfo,
    getAllUsers,
    clearUserCache,

    // 群组相关方法（兼容性）
    getGroupInfo,
    getBatchGroupInfo,
    getAllGroups,
    clearGroupCache
  }
}

export default useEntityInfo
