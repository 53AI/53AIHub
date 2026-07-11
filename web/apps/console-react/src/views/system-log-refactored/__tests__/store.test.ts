/**
 * Store 单元测试
 * 测试纯函数：calculateCurrentPage, calculateOffset
 * 测试 Actions：成功流程、错误处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateCurrentPage, calculateOffset, useSystemLogStore } from '../store'

// Mock API - 必须在顶层，使用工厂函数避免 hoisting 问题
vi.mock('../api/systemLogApi', () => ({
  systemLogApi: {
    list: vi.fn(),
    actions: vi.fn(),
    modules: vi.fn(),
  },
  getDefaultListParams: () => ({
    offset: 0,
    limit: 10,
    user_id: null,
    start_time: null,
    end_time: null,
    module: undefined,
    action: undefined,
  }),
  transformSystemLogList: (items: any[]) => items,
}))

import { systemLogApi } from '../api/systemLogApi'

const mockApi = systemLogApi as unknown as {
  list: ReturnType<typeof vi.fn>
  actions: ReturnType<typeof vi.fn>
  modules: ReturnType<typeof vi.fn>
}

describe('calculateCurrentPage', () => {
  it('offset=0, limit=10 → page=1', () => {
    expect(calculateCurrentPage(0, 10)).toBe(1)
  })

  it('offset=10, limit=10 → page=2', () => {
    expect(calculateCurrentPage(10, 10)).toBe(2)
  })

  it('offset=20, limit=10 → page=3', () => {
    expect(calculateCurrentPage(20, 10)).toBe(3)
  })

  it('offset=0, limit=20 → page=1', () => {
    expect(calculateCurrentPage(0, 20)).toBe(1)
  })

  it('offset=40, limit=20 → page=3', () => {
    expect(calculateCurrentPage(40, 20)).toBe(3)
  })
})

describe('calculateOffset', () => {
  it('page=1, pageSize=10 → offset=0', () => {
    expect(calculateOffset(1, 10)).toBe(0)
  })

  it('page=2, pageSize=10 → offset=10', () => {
    expect(calculateOffset(2, 10)).toBe(10)
  })

  it('page=3, pageSize=10 → offset=20', () => {
    expect(calculateOffset(3, 10)).toBe(20)
  })

  it('page=1, pageSize=20 → offset=0', () => {
    expect(calculateOffset(1, 20)).toBe(0)
  })

  it('page=3, pageSize=20 → offset=40', () => {
    expect(calculateOffset(3, 20)).toBe(40)
  })
})

describe('Store 状态管理', () => {
  it('初始状态应该正确', () => {
    const state = useSystemLogStore.getState()
    expect(state.list).toEqual([])
    expect(state.total).toBe(0)
    expect(state.actions).toEqual([])
    expect(state.modules).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.params.offset).toBe(0)
    expect(state.params.limit).toBe(10)
    expect(state.dateRange).toEqual([null, null])
  })
})

describe('Store Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 设置默认 mock 返回值，避免 loadList 调用失败
    mockApi.list.mockResolvedValue({ system_logs: [], count: 0 })
    mockApi.actions.mockResolvedValue([])
    mockApi.modules.mockResolvedValue([])

    // 重置 store 到初始状态
    useSystemLogStore.setState({
      list: [],
      total: 0,
      actions: [],
      modules: [],
      params: {
        offset: 20,
        limit: 10,
        user_id: null,
        start_time: null,
        end_time: null,
        module: undefined,
        action: undefined,
      },
      dateRange: [null, null],
      loading: false,
    })
  })

  it('setFilterParams 应该重置 offset 为 0', () => {
    const store = useSystemLogStore.getState()
    // 当前 offset 为 20
    expect(store.params.offset).toBe(20)

    store.setFilterParams({ action: 1 })

    const updated = useSystemLogStore.getState()
    expect(updated.params.offset).toBe(0)
    expect(updated.params.action).toBe(1)
  })

  it('setParams 应该保留 offset', () => {
    const store = useSystemLogStore.getState()
    expect(store.params.offset).toBe(20)

    store.setParams({ action: 1 })

    const updated = useSystemLogStore.getState()
    expect(updated.params.offset).toBe(20)
    expect(updated.params.action).toBe(1)
  })

  it('setDateRange 应该重置 offset 并更新日期', async () => {
    const store = useSystemLogStore.getState()
    expect(store.params.offset).toBe(20)

    await store.setDateRange([1000, 2000])

    const updated = useSystemLogStore.getState()
    expect(updated.params.offset).toBe(0)
    expect(updated.dateRange).toEqual([1000, 2000])
    expect(updated.params.start_time).toBe(1000)
    expect(updated.params.end_time).toBe(2000)
  })

  it('resetParams 应该重置所有筛选条件', async () => {
    // 先设置一些状态
    useSystemLogStore.setState({
      params: {
        offset: 50,
        limit: 20,
        user_id: null,
        start_time: 1000,
        end_time: 2000,
        module: 5,
        action: 3,
      },
      dateRange: [1000, 2000],
    })

    const store = useSystemLogStore.getState()
    await store.resetParams()

    const updated = useSystemLogStore.getState()
    expect(updated.params.offset).toBe(0)
    expect(updated.params.limit).toBe(10)
    expect(updated.params.module).toBeUndefined()
    expect(updated.params.action).toBeUndefined()
    expect(updated.params.start_time).toBeNull()
    expect(updated.params.end_time).toBeNull()
    expect(updated.dateRange).toEqual([null, null])
  })
})

describe('renderNullableText (边界条件)', () => {
  // 模拟 renderNullableText 函数
  const EMPTY_TEXT_COLOR = '#999'

  function renderNullableText(
    value: string | number | undefined | null,
  ): { text: string; color?: string } {
    if (value === undefined || value === null || value === '') {
      return { text: '-', color: EMPTY_TEXT_COLOR }
    }
    return { text: String(value) }
  }

  it('undefined 应该显示 "-"', () => {
    const result = renderNullableText(undefined)
    expect(result.text).toBe('-')
    expect(result.color).toBe(EMPTY_TEXT_COLOR)
  })

  it('null 应该显示 "-"', () => {
    const result = renderNullableText(null)
    expect(result.text).toBe('-')
    expect(result.color).toBe(EMPTY_TEXT_COLOR)
  })

  it('空字符串应该显示 "-"', () => {
    const result = renderNullableText('')
    expect(result.text).toBe('-')
    expect(result.color).toBe(EMPTY_TEXT_COLOR)
  })

  it('数字应该正常显示', () => {
    const result = renderNullableText(123)
    expect(result.text).toBe('123')
    expect(result.color).toBeUndefined()
  })

  it('字符串应该正常显示', () => {
    const result = renderNullableText('测试')
    expect(result.text).toBe('测试')
    expect(result.color).toBeUndefined()
  })

  it('0 应该正常显示（不是空值）', () => {
    const result = renderNullableText(0)
    expect(result.text).toBe('0')
    expect(result.color).toBeUndefined()
  })
})

describe('Store 成功流程', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重置 store
    useSystemLogStore.setState({
      list: [],
      total: 0,
      actions: [],
      modules: [],
      params: {
        offset: 0,
        limit: 10,
        user_id: null,
        start_time: null,
        end_time: null,
        module: undefined,
        action: undefined,
      },
      dateRange: [null, null],
      loading: false,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('loadList', () => {
    it('成功时应该更新 list 和 total', async () => {
      const mockData = [
        { id: 1, action_time: Date.now(), action: 1, module: 1, nickname: '用户1', content: '操作1', ip: '127.0.0.1' },
        { id: 2, action_time: Date.now(), action: 2, module: 2, nickname: '用户2', content: '操作2', ip: '127.0.0.2' },
      ]
      mockApi.list.mockResolvedValueOnce({
        system_logs: mockData,
        count: 100,
      })

      const store = useSystemLogStore.getState()
      await store.loadList()

      const updated = useSystemLogStore.getState()
      expect(updated.list).toEqual(mockData)
      expect(updated.total).toBe(100)
      expect(updated.loading).toBe(false)
    })

    it('应该正确传递日期参数', async () => {
      mockApi.list.mockResolvedValueOnce({ system_logs: [], count: 0 })

      useSystemLogStore.setState({
        dateRange: [1000, 2000],
      })

      const store = useSystemLogStore.getState()
      await store.loadList()

      expect(mockApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          start_time: 1000,
          end_time: 2000,
        })
      )
    })

    it('应该正确传递筛选参数', async () => {
      mockApi.list.mockResolvedValueOnce({ system_logs: [], count: 0 })

      const store = useSystemLogStore.getState()
      await store.loadList({ action: 1, module: 2 })

      expect(mockApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 1,
          module: 2,
        })
      )
    })

    it('调用期间 loading 应该为 true', async () => {
      let resolveFn: () => void
      mockApi.list.mockImplementation(() => new Promise((resolve) => {
        resolveFn = () => resolve({ system_logs: [], count: 0 })
      }))

      const store = useSystemLogStore.getState()
      const promise = store.loadList()

      // 调用期间检查 loading 状态
      expect(useSystemLogStore.getState().loading).toBe(true)

      // 完成 promise
      resolveFn!()
      await promise

      expect(useSystemLogStore.getState().loading).toBe(false)
    })
  })

  describe('loadActions', () => {
    it('成功时应该更新 actions', async () => {
      const mockActions = [
        { value: 1, text: '登录' },
        { value: 2, text: '登出' },
      ]
      mockApi.actions.mockResolvedValueOnce(mockActions)

      const store = useSystemLogStore.getState()
      await store.loadActions()

      const updated = useSystemLogStore.getState()
      expect(updated.actions).toEqual(mockActions)
    })
  })

  describe('loadModules', () => {
    it('成功时应该更新 modules', async () => {
      const mockModules = [
        { value: 1, text: '用户管理' },
        { value: 2, text: '系统设置' },
      ]
      mockApi.modules.mockResolvedValueOnce(mockModules)

      const store = useSystemLogStore.getState()
      await store.loadModules()

      const updated = useSystemLogStore.getState()
      expect(updated.modules).toEqual(mockModules)
    })
  })

  describe('refresh', () => {
    it('应该重新调用 loadList', async () => {
      mockApi.list.mockResolvedValue({ system_logs: [], count: 0 })

      const store = useSystemLogStore.getState()
      await store.refresh()

      expect(mockApi.list).toHaveBeenCalledTimes(1)
    })
  })
})
