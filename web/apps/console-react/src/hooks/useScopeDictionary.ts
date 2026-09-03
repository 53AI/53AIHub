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

/** 把后端 user 字段映射为统一字典节点,保留 dept_id_list 等下游需要的字段 */
const mapUser = (item: any): ScopeDisplayTreeNode => ({
  value: item.user_id,
  label: item.nickname || item.name || '',
  user_id: item.user_id,
  nickname: item.nickname,
  name: item.name,
  // DeptMemberPicker 用 dept_id_list 把成员挂到对应部门下,即使 ScopeDisplay
  // 不用也保留——多余字段对 ScopeDisplay 无害
  dept_id_list: item.dept_id_list || [],
})

const mapGroup = (item: any): ScopeDisplayTreeNode => ({
  value: item.group_id,
  label: item.group_name || '',
  group_id: item.group_id,
  group_name: item.group_name,
})

/**
 * 共享 ScopeDisplay 字典加载器。
 *
 * 三层失效策略,确保数据新鲜:
 * 1. 内存缓存(TTL 2min):过期自动重新拉取,无需人工干预
 * 2. 登录事件:user-login-success / user-login-expired 触发失效,新会话=新数据
 * 3. 手动失效:CRUD 后调用 invalidateScopeDictionary() 立即失效
 *
 * 并发请求自动 dedup,任何调用方(hook 或组件)都拿到同一份数据。
 * ScopeDisplay / DeptMemberPicker 在父级未传入字典时也走这里,避免每行重复打网络。
 */
export function loadScopeDictionary(): Promise<ScopeDictionary> {
  return cacheManager.getOrFetch<ScopeDictionary>(
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
        users: ((userList && userList.list) || []).map(mapUser),
        groups: (groupList || []).map(mapGroup),
      }
    },
    CACHE_TTL_MINUTES,
    CacheMode.MEMORY,
  )
}

/**
 * 共享 ScopeDisplay 字典 hook。
 * 推荐用于列表层,在父组件调用一次,把数据通过 props 下发给每行的 ScopeDisplay / DeptMemberPicker。
 */
export function useScopeDictionary(): ScopeDictionary | null {
  const [dict, setDict] = useState<ScopeDictionary | null>(null)

  useEffect(() => {
    let cancelled = false

    loadScopeDictionary()
      .then((data) => {
        if (!cancelled) setDict(data)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[useScopeDictionary] load failed', err)
        }
      })

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
 * 主动清除缓存,下次 loadScopeDictionary() / useScopeDictionary() 会重新拉取。
 * 在部门 / 用户 / 分组 的 CRUD 操作成功后调用即可。
 */
export function invalidateScopeDictionary(): void {
  cacheManager.delete(CACHE_KEY, CacheMode.MEMORY)
}