import { useEffect, useState } from 'react'
import { departmentApi } from '@/api/modules/department'
import { INTERNAL_USER_STATUS_ALL, userApi } from '@/api/modules/user'
import { groupApi } from '@/api/modules/group'
import { GROUP_TYPE } from '@/constants/group'
import type { ScopeDisplayTreeNode } from '@/components/ScopeDisplay'
import { cacheManager, eventBus, CacheMode } from '@km/shared-utils'

export interface ScopeDictionary {
  treeData: ScopeDisplayTreeNode[]
  users: ScopeDisplayTreeNode[]
  groups: ScopeDisplayTreeNode[]
}

const CACHE_KEY = 'scope_dictionary_v1'
// TTL 与项目内 useEntityInfo 对齐,过期自动重拉,避免长时间陈旧
const CACHE_TTL_MINUTES = 2

/**
 * 共享 ScopeDisplay 字典 hook。
 *
 * 三层失效策略,确保数据新鲜:
 * 1. 内存缓存(TTL 5min):过期自动重新拉取,无需人工干预
 * 2. 登录事件:user-login-success / user-login-expired 触发失效,新会话=新数据
 * 3. 手动失效:CRUD 后调用 invalidateScopeDictionary() 立即失效
 *
 * 并发请求自动 dedup,任何调用方都拿到同一份数据。
 */
export function useScopeDictionary(): ScopeDictionary | null {
  const [dict, setDict] = useState<ScopeDictionary | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const data = await cacheManager.getOrFetch<ScopeDictionary>(
          CACHE_KEY,
          async () => {
            const [deptTree, userList, groupList] = await Promise.all([
              departmentApi.fetch_department_tree(),
              userApi.fetch_internal_user({
                status: INTERNAL_USER_STATUS_ALL,
                offset: 0,
                limit: 10000,
              }),
              groupApi.list({
                params: { group_type: GROUP_TYPE.INTERNAL_USER },
              }),
            ])
            return {
              treeData: (deptTree || []) as ScopeDisplayTreeNode[],
              users: ((userList && userList.list) || []).map((item: any) => ({
                value: item.user_id,
                label: item.nickname || item.name || '',
                user_id: item.user_id,
              })),
              groups: (groupList || []).map((item: any) => ({
                value: item.group_id,
                label: item.group_name || '',
              })),
            }
          },
          CACHE_TTL_MINUTES,
          CacheMode.MEMORY,
        )
        if (!cancelled) setDict(data)
      } catch (err) {
        if (!cancelled) {
          console.error('[useScopeDictionary] load failed', err)
        }
      }
    }

    load()

    // 登录 / 登出后数据应被视为陈旧,主动失效让下次重新拉取
    const handleLoginChange = () => {
      invalidateScopeDictionary()
    }
    eventBus.on('user-login-success', handleLoginChange)
    eventBus.on('user-login-expired', handleLoginChange)

    return () => {
      cancelled = true
      eventBus.off('user-login-success', handleLoginChange)
      eventBus.off('user-login-expired', handleLoginChange)
    }
  }, [])

  return dict
}

/**
 * 主动清除缓存,下次 useScopeDictionary 调用会重新拉取。
 * 在部门 / 用户 / 分组 的 CRUD 操作成功后调用即可。
 */
export function invalidateScopeDictionary(): void {
  cacheManager.delete(CACHE_KEY, CacheMode.MEMORY)
}