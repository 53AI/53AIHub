/**
 * toolboxApi 单元测试
 * 测试 API 层的参数转换和数据映射逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createToolboxApi, toolboxApi, type ToolboxApiInterface } from '../../api/toolboxApi'
import type { AiLinkItem, RawGroupOption, SortItem, AiLinkDetail } from '../../types'

// Mock 外部 API 模块
vi.mock('@/api/modules/ai-link', () => ({
  aiLinkApi: {
    list: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    store: vi.fn(),
    sort: vi.fn(),
    detail: vi.fn(),
  },
}))

vi.mock('@/api/modules/group', () => ({
  default: {
    list: vi.fn(),
  },
}))

import { aiLinkApi } from '@/api/modules/ai-link'
import groupApi from '@/api/modules/group'

const mockAiLinkApi = aiLinkApi as any
const mockGroupApi = groupApi as any

describe('toolboxApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('list', () => {
    it('应该正确处理空参数', async () => {
      mockAiLinkApi.list.mockResolvedValue([])

      const result = await toolboxApi.list({})

      expect(mockAiLinkApi.list).toHaveBeenCalledWith({
        params: {},
        paramsSerializer: expect.any(Function),
      })
      expect(result).toEqual([])
    })

    it('应该正确转换 group_id 参数', async () => {
      mockAiLinkApi.list.mockResolvedValue([])

      await toolboxApi.list({ group_id: [1, 2, 3] })

      const callArgs = mockAiLinkApi.list.mock.calls[0][0]
      expect(callArgs.params.group_id).toEqual([1, 2, 3])
    })

    it('应该过滤负数 group_id', async () => {
      mockAiLinkApi.list.mockResolvedValue([])

      await toolboxApi.list({ group_id: [-1, 1, 2] })

      const callArgs = mockAiLinkApi.list.mock.calls[0][0]
      // 负数 group_id 会被过滤，但空数组会被设为 undefined
      expect(callArgs.params.group_id).toBeUndefined()
    })

    it('应该正确处理 keyword 参数', async () => {
      mockAiLinkApi.list.mockResolvedValue([])

      await toolboxApi.list({ keyword: 'test' })

      const callArgs = mockAiLinkApi.list.mock.calls[0][0]
      expect(callArgs.params.keyword).toBe('test')
    })

    it('paramsSerializer 应该正确序列化数组参数', async () => {
      mockAiLinkApi.list.mockResolvedValue([])

      await toolboxApi.list({ group_id: [1, 2], keyword: 'search' })

      const callArgs = mockAiLinkApi.list.mock.calls[0][0]
      const serialized = callArgs.paramsSerializer({ group_id: [1, 2], keyword: 'search' })

      expect(serialized).toContain('group_id=1')
      expect(serialized).toContain('group_id=2')
      expect(serialized).toContain('keyword=search')
    })
  })

  describe('save', () => {
    it('应该调用 aiLinkApi.save 并返回数据', async () => {
      const mockData: AiLinkDetail = { ai_link_id: '123', name: 'Test' }
      mockAiLinkApi.save.mockResolvedValue(mockData)

      const result = await toolboxApi.save({ name: 'Test' })

      expect(mockAiLinkApi.save).toHaveBeenCalledWith({ data: { name: 'Test' } })
      expect(result).toEqual(mockData)
    })
  })

  describe('delete', () => {
    it('应该调用 aiLinkApi.delete 并传入正确参数', async () => {
      mockAiLinkApi.delete.mockResolvedValue(undefined)

      await toolboxApi.delete('123')

      expect(mockAiLinkApi.delete).toHaveBeenCalledWith({ data: { ai_link_id: '123' } })
    })
  })

  describe('store', () => {
    it('应该调用 aiLinkApi.store 并返回数据', async () => {
      const mockStoreData = {
        data: [{ group_name: 'Group 1', links: [] }],
      }
      mockAiLinkApi.store.mockResolvedValue(mockStoreData)

      const result = await toolboxApi.store()

      expect(mockAiLinkApi.store).toHaveBeenCalled()
      expect(result).toEqual(mockStoreData)
    })
  })

  describe('sort', () => {
    it('应该调用 aiLinkApi.sort 并传入排序项', async () => {
      mockAiLinkApi.sort.mockResolvedValue(undefined)

      const items: SortItem[] = [
        { group_id: 1, id: '1', sort: 1 },
        { group_id: 1, id: '2', sort: 2 },
      ]

      await toolboxApi.sort(items)

      expect(mockAiLinkApi.sort).toHaveBeenCalledWith({ items })
    })
  })

  describe('detail', () => {
    it('应该调用 aiLinkApi.detail 并返回数据', async () => {
      const mockDetail = { data: { ai_link_id: '123', name: 'Test' } }
      mockAiLinkApi.detail.mockResolvedValue(mockDetail)

      const result = await toolboxApi.detail('123')

      expect(mockAiLinkApi.detail).toHaveBeenCalledWith('123')
      expect(result).toEqual(mockDetail)
    })
  })

  describe('loadGroups', () => {
    it('应该调用 groupApi.list 并映射数据', async () => {
      const mockGroupResponse = [
        { group_id: 1, group_name: 'Group 1', sort: 1 },
        { group_id: 2, group_name: 'Group 2', sort: 2 },
      ]
      mockGroupApi.list.mockResolvedValue(mockGroupResponse)

      const result = await toolboxApi.loadGroups(3)

      expect(mockGroupApi.list).toHaveBeenCalledWith({
        params: { group_type: 2 },
      })
      expect(result).toEqual([
        { group_id: 1, group_name: 'Group 1', sort: 1 },
        { group_id: 2, group_name: 'Group 2', sort: 2 },
      ])
    })

    it('应该处理空响应', async () => {
      mockGroupApi.list.mockResolvedValue(null)

      const result = await toolboxApi.loadGroups(3)

      expect(result).toEqual([])
    })

    it('应该为缺失 sort 字段设置默认值', async () => {
      const mockGroupResponse = [
        { group_id: 1, group_name: 'Group 1' },
      ]
      mockGroupApi.list.mockResolvedValue(mockGroupResponse)

      const result = await toolboxApi.loadGroups(3)

      expect(result[0].sort).toBe(0)
    })
  })
})

describe('createToolboxApi', () => {
  it('应该创建默认 API 实例', () => {
    const api = createToolboxApi()

    expect(api.list).toBeDefined()
    expect(api.save).toBeDefined()
    expect(api.delete).toBeDefined()
    expect(api.store).toBeDefined()
    expect(api.sort).toBeDefined()
    expect(api.detail).toBeDefined()
    expect(api.loadGroups).toBeDefined()
  })

  it('应该支持覆盖方法', async () => {
    const mockList = vi.fn().mockResolvedValue([{ id: 'custom' }])
    const api = createToolboxApi({ list: mockList })

    const result = await api.list({})

    expect(mockList).toHaveBeenCalled()
    expect(result).toEqual([{ id: 'custom' }])
  })
})
