/**
 * systemLogApi 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { systemLogApi, createSystemLogApi, getDefaultListParams } from '../../api/systemLogApi'
import type { SystemLogApiInterface } from '../../api/systemLogApi'

// Mock 外部 API 模块
vi.mock('@/api/modules/system-log', () => ({
  systemLogApi: {
    list: vi.fn(),
    create: vi.fn(),
    actions: vi.fn(),
    modules: vi.fn(),
  },
}))

vi.mock('@km/shared-utils', () => ({
  getSimpleDateFormatString: vi.fn(({ date }) => `formatted-${date}`),
}))

import { systemLogApi as originalApi } from '@/api/modules/system-log'

const mockOriginalApi = originalApi as unknown as {
  list: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  actions: ReturnType<typeof vi.fn>
  modules: ReturnType<typeof vi.fn>
}

describe('systemLogApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('list', () => {
    it('应该调用原始 API 并返回数据', async () => {
      const mockResponse = {
        system_logs: [{ id: 1, action_time: Date.now() }],
        count: 1,
      }
      mockOriginalApi.list.mockResolvedValue(mockResponse)

      const params = { offset: 0, limit: 10 }
      const result = await systemLogApi.list(params)

      expect(mockOriginalApi.list).toHaveBeenCalledWith(params)
      expect(result).toEqual(mockResponse)
    })
  })

  describe('create', () => {
    it('应该调用原始 API 创建日志', async () => {
      mockOriginalApi.create.mockResolvedValue({})

      await systemLogApi.create({ action: 1, content: '测试日志' })

      expect(mockOriginalApi.create).toHaveBeenCalledWith({
        action: 1,
        content: '测试日志',
      })
    })
  })

  describe('actions', () => {
    it('应该返回操作类型列表', async () => {
      const mockActions = [
        { value: 1, text: '登录' },
        { value: 2, text: '登出' },
      ]
      mockOriginalApi.actions.mockResolvedValue(mockActions)

      const result = await systemLogApi.actions()

      expect(result).toEqual(mockActions)
    })
  })

  describe('modules', () => {
    it('应该返回模块列表', async () => {
      const mockModules = [
        { value: 1, text: '用户管理' },
        { value: 2, text: '系统设置' },
      ]
      mockOriginalApi.modules.mockResolvedValue(mockModules)

      const result = await systemLogApi.modules()

      expect(result).toEqual(mockModules)
    })
  })
})

describe('getDefaultListParams', () => {
  it('应该返回默认参数', () => {
    const params = getDefaultListParams()

    expect(params).toEqual({
      offset: 0,
      limit: 10,
      user_id: null,
      start_time: null,
      end_time: null,
      module: undefined,
      action: undefined,
    })
  })
})

describe('createSystemLogApi', () => {
  it('应该创建默认 API 实例', () => {
    const api = createSystemLogApi()

    expect(api.list).toBeDefined()
    expect(api.create).toBeDefined()
    expect(api.actions).toBeDefined()
    expect(api.modules).toBeDefined()
  })

  it('应该支持覆盖方法', async () => {
    const mockList = vi.fn().mockResolvedValue({ system_logs: [], count: 0 })
    const api = createSystemLogApi({ list: mockList })

    const result = await api.list({ offset: 0, limit: 10 })

    expect(mockList).toHaveBeenCalled()
    expect(result).toEqual({ system_logs: [], count: 0 })
  })
})
