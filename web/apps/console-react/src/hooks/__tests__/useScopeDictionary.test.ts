import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock APIs (在 hook 测试之前 mock)
vi.mock('@/api/modules/department', () => ({
  departmentApi: {
    fetch_department_tree: vi.fn(() =>
      Promise.resolve([{ value: 1, label: '技术部', did: 1, children: [] }])
    ),
  },
  getRootDepartmentData: vi.fn(() =>
    Promise.resolve({ value: 0, label: '全部成员' })
  ),
}))

vi.mock('@/api/modules/user', () => ({
  INTERNAL_USER_STATUS_ALL: 0,
  userApi: {
    fetch_internal_user: vi.fn(() =>
      Promise.resolve({ list: [{ user_id: 100, nickname: '张三' }] })
    ),
  },
}))

vi.mock('@/api/modules/group', () => ({
  groupApi: {
    list: vi.fn(() =>
      Promise.resolve([{ group_id: 10, group_name: '管理员组' }])
    ),
  },
}))

vi.mock('@km/shared-utils', async () => {
  const actual = await vi.importActual<any>('@km/shared-utils')
  const memory = new Map<string, { value: unknown; expireTime: number }>()
  const pendingPromises = new Map<string, Promise<unknown>>()
  const fakeCacheManager = {
    async getOrFetch<T>(
      key: string,
      fetcher: () => Promise<T>,
      _expireMinutes: number,
    ): Promise<T> {
      const cached = memory.get(key)
      if (cached && cached.expireTime > Date.now()) {
        return cached.value as T
      }
      const pendingKey = `MEMORY:${key}`
      if (pendingPromises.has(pendingKey)) {
        return pendingPromises.get(pendingKey) as Promise<T>
      }
      const p = (async () => {
        const v = await fetcher()
        memory.set(key, { value: v, expireTime: Date.now() + 5 * 60 * 1000 })
        return v
      })().finally(() => pendingPromises.delete(pendingKey))
      pendingPromises.set(pendingKey, p)
      return p as Promise<T>
    },
    async delete(key: string): Promise<void> {
      memory.delete(key)
    },
  }
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const fakeEventBus = {
    on(event: string, fn: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    off(event: string, fn: (...args: any[]) => void) {
      listeners.get(event)?.delete(fn)
    },
    emit(event: string, ...args: any[]) {
      listeners.get(event)?.forEach((fn) => fn(...args))
    },
  }
  return {
    ...actual,
    cacheManager: fakeCacheManager,
    eventBus: fakeEventBus,
    CacheMode: { MEMORY: 'MEMORY' },
  }
})

import { departmentApi } from '@/api/modules/department'
import { userApi } from '@/api/modules/user'
import { groupApi } from '@/api/modules/group'
import { eventBus } from '@km/shared-utils'
import {
  useScopeDictionary,
  invalidateScopeDictionary,
} from '../useScopeDictionary'

describe('useScopeDictionary', () => {
  beforeEach(() => {
    invalidateScopeDictionary()
    vi.mocked(departmentApi.fetch_department_tree).mockClear()
    vi.mocked(userApi.fetch_internal_user).mockClear()
    vi.mocked(groupApi.list).mockClear()
  })

  it('fetches all three APIs on first mount', async () => {
    const { result } = renderHook(() => useScopeDictionary())

    await waitFor(() => {
      expect(result.current).not.toBeNull()
    })

    expect(departmentApi.fetch_department_tree).toHaveBeenCalledTimes(1)
    expect(userApi.fetch_internal_user).toHaveBeenCalledTimes(1)
    expect(groupApi.list).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-fetch when a second consumer mounts while data is cached', async () => {
    const first = renderHook(() => useScopeDictionary())
    await waitFor(() => {
      expect(first.result.current).not.toBeNull()
    })

    const second = renderHook(() => useScopeDictionary())
    await waitFor(() => {
      expect(second.result.current).toEqual(first.result.current)
    })

    expect(departmentApi.fetch_department_tree).toHaveBeenCalledTimes(1)
    expect(userApi.fetch_internal_user).toHaveBeenCalledTimes(1)
    expect(groupApi.list).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent mounts in flight', async () => {
    const a = renderHook(() => useScopeDictionary())
    const b = renderHook(() => useScopeDictionary())
    const c = renderHook(() => useScopeDictionary())

    await waitFor(() => {
      expect(a.result.current).not.toBeNull()
      expect(b.result.current).not.toBeNull()
      expect(c.result.current).not.toBeNull()
    })

    expect(departmentApi.fetch_department_tree).toHaveBeenCalledTimes(1)
    expect(userApi.fetch_internal_user).toHaveBeenCalledTimes(1)
    expect(groupApi.list).toHaveBeenCalledTimes(1)
  })

  it('refetches after invalidateScopeDictionary()', async () => {
    const first = renderHook(() => useScopeDictionary())
    await waitFor(() => expect(first.result.current).not.toBeNull())

    invalidateScopeDictionary()

    const second = renderHook(() => useScopeDictionary())
    await waitFor(() => expect(second.result.current).not.toBeNull())

    expect(departmentApi.fetch_department_tree).toHaveBeenCalledTimes(2)
    expect(userApi.fetch_internal_user).toHaveBeenCalledTimes(2)
    expect(groupApi.list).toHaveBeenCalledTimes(2)
  })

  it('auto-invalidates cache on user-login-success event', async () => {
    const first = renderHook(() => useScopeDictionary())
    await waitFor(() => expect(first.result.current).not.toBeNull())

    // 模拟另一个用户登录
    eventBus.emit('user-login-success')

    const second = renderHook(() => useScopeDictionary())
    await waitFor(() => expect(second.result.current).not.toBeNull())

    expect(departmentApi.fetch_department_tree).toHaveBeenCalledTimes(2)
    expect(userApi.fetch_internal_user).toHaveBeenCalledTimes(2)
    expect(groupApi.list).toHaveBeenCalledTimes(2)
  })

  it('auto-invalidates cache on user-login-expired event', async () => {
    const first = renderHook(() => useScopeDictionary())
    await waitFor(() => expect(first.result.current).not.toBeNull())

    eventBus.emit('user-login-expired')

    const second = renderHook(() => useScopeDictionary())
    await waitFor(() => expect(second.result.current).not.toBeNull())

    expect(departmentApi.fetch_department_tree).toHaveBeenCalledTimes(2)
  })
})