import { useCallback, useRef, useState } from 'react'
import { userApi, INTERNAL_USER_STATUS_ALL } from '@/api/modules/user'
import { groupApi } from '@/api/modules/group'
import { GROUP_TYPE } from '@/constants/group'
import { cacheManager as cache } from '@km/shared-utils'
import type {
  EntityType,
  UserInfo,
  GroupInfo,
  EntityInfo,
  EntityCacheConfig,
} from '@/types/entity'
import { ENTITY_TYPE } from '@/types/entity'
import { useUserStore } from '@/stores'

const mapToUserInfo = (item: Record<string, unknown>): UserInfo => ({
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
  label: String(item.nickname || item.name || ''),
})

/**
 * 统一实体信息管理 Hook
 * 提供用户和群组信息获取和缓存功能
 */
const CACHE_CONFIG: Record<EntityType, EntityCacheConfig> = {
  [ENTITY_TYPE.USER]: { duration: 5, keyPrefix: 'all_users_list' },
  [ENTITY_TYPE.GROUP]: { duration: 5, keyPrefix: 'all_groups_list' },
}

export function useEntityInfo() {
  const [loading, setLoading] = useState(false)
  const pendingRequestsRef = useRef(new Map<string, Promise<EntityInfo[]>>())
  const userStore = useUserStore()

  const cacheConfig = CACHE_CONFIG

  const getCachedEntities = useCallback(
    async <T extends EntityInfo>(type: EntityType, fetcher: () => Promise<T[]>): Promise<T[]> => {
      const config = cacheConfig[type]
      const cacheKey = config.keyPrefix
      const pendingRequests = pendingRequestsRef.current

      if (pendingRequests.has(cacheKey)) {
        return pendingRequests.get(cacheKey) as Promise<T[]>
      }
      const cached = await cache.get<T[]>(cacheKey)
      if (cached) return cached

      const request = (async () => {
        try {
          setLoading(true)
          return await cache.getOrFetch(cacheKey, fetcher, config.duration)
        } catch (error) {
          console.error(
            `获取${type === ENTITY_TYPE.USER ? '用户' : '群组'}列表失败:`,
            error,
          )
          return []
        } finally {
          setLoading(false)
          pendingRequests.delete(cacheKey)
        }
      })()

      pendingRequests.set(cacheKey, request)
      return request
    },
    [],
  )

  const getAllUsers = useCallback(async (): Promise<UserInfo[]> => {
    return getCachedEntities(ENTITY_TYPE.USER, async () => {
      const params = {
        status: INTERNAL_USER_STATUS_ALL,
        offset: 0,
        limit: 10000,
      }
      const internal = await userApi.fetch_internal_user(params)
      const internalUsers: UserInfo[] = (internal.list as Record<string, unknown>[]).map(
        mapToUserInfo,
      )

      let registeredUsers: UserInfo[] = []
      try {
        const result = await (userStore.loadListData as (opts?: {
          data?: { offset?: number; limit?: number }
          hideError?: boolean
        }) => Promise<{ list?: unknown[] }>)?.({ data: { offset: 0, limit: 10000 }, hideError: true })
        const list = result?.list ?? []
        registeredUsers = (list as Record<string, unknown>[]).map(mapToUserInfo)
      } catch {
        registeredUsers = []
      }

      const map = new Map<number, UserInfo>()
      ;[...internalUsers, ...registeredUsers].forEach(u => {
        map.set(u.user_id, u)
      })
      return Array.from(map.values())
    })
  }, [getCachedEntities, userStore])

  const getAllGroups = useCallback(async (): Promise<GroupInfo[]> => {
    return getCachedEntities(ENTITY_TYPE.GROUP, async () => {
      const res = await groupApi.list({
        params: { group_type: GROUP_TYPE.INTERNAL_USER },
      })
      return (res as Record<string, unknown>[]).map(
        (item): GroupInfo => ({
          group_id: Number(item.group_id) || 0,
          group_name: String(item.group_name || ''),
          sort: Number(item.sort) || 0,
          value: Number(item.group_id) || 0,
          label: String(item.group_name || ''),
          avatar: String(item.avatar || ''),
        }),
      )
    })
  }, [getCachedEntities])

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
    [getAllUsers, getAllGroups],
  )

  const getUserInfo = useCallback(
    async (userId: number): Promise<UserInfo | null> => {
      if (!userId) return null
      try {
        const allUsers = await getAllUsers()
        const user = allUsers.find(item => +item.user_id === +userId)
        return user ?? null
      } catch (error) {
        console.error('获取用户信息失败:', error)
        return null
      }
    },
    [getAllUsers],
  )

  const getGroupInfo = useCallback(
    async (groupId: number): Promise<GroupInfo | null> => {
      if (!groupId) return null
      try {
        const allGroups = await getAllGroups()
        const group = allGroups.find(item => +item.group_id === +groupId)
        return group ?? null
      } catch (error) {
        console.error('获取群组信息失败:', error)
        return null
      }
    },
    [getAllGroups],
  )

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
    [getUserInfo, getGroupInfo],
  )

  const getBatchUserInfo = useCallback(
    async (userIds: number[]): Promise<UserInfo[]> => {
      if (!userIds.length) return []
      try {
        const allUsers = await getAllUsers()
        return allUsers.filter(item => userIds.includes(+item.user_id))
      } catch (error) {
        console.error('批量获取用户信息失败:', error)
        return []
      }
    },
    [getAllUsers],
  )

  const getBatchGroupInfo = useCallback(
    async (groupIds: number[]): Promise<GroupInfo[]> => {
      if (!groupIds.length) return []
      try {
        const allGroups = await getAllGroups()
        return allGroups.filter(item => groupIds.includes(+item.group_id))
      } catch (error) {
        console.error('批量获取群组信息失败:', error)
        return []
      }
    },
    [getAllGroups],
  )

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
    [getBatchUserInfo, getBatchGroupInfo],
  )

  const clearEntityCache = useCallback((type?: EntityType, _id?: number) => {
    const pendingRequests = pendingRequestsRef.current
    if (type) {
      const cacheKey = cacheConfig[type].keyPrefix
      pendingRequests.delete(cacheKey)
      cache.delete(cacheKey)
    } else {
      Object.values(cacheConfig).forEach(config => {
        pendingRequests.delete(config.keyPrefix)
        cache.delete(config.keyPrefix)
      })
    }
  }, [])

  const clearUserCache = useCallback(() => {
    clearEntityCache(ENTITY_TYPE.USER)
  }, [clearEntityCache])

  const clearGroupCache = useCallback(() => {
    clearEntityCache(ENTITY_TYPE.GROUP)
  }, [clearEntityCache])

  return {
    loading,
    getEntityInfo,
    getBatchEntityInfo,
    getAllEntities,
    clearEntityCache,
    getUserInfo,
    getBatchUserInfo,
    getAllUsers,
    clearUserCache,
    getGroupInfo,
    getBatchGroupInfo,
    getAllGroups,
    clearGroupCache,
  }
}
