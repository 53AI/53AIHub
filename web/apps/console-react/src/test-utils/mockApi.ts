/**
 * API mock 工具
 * 用于测试中 mock API 调用
 */
import { vi } from 'vitest'

/**
 * AI Link 相关数据类型
 */
interface AiLinkItem {
  ai_link_id: string
  name: string
  description: string
  logo: string
  url: string
  group_id: number
  sort: number
  shared_account?: string
  user_group_ids?: number[]
  subscription_group_ids?: number[]
}

interface GroupOption {
  group_id: number
  group_name: string
  children?: AiLinkItem[]
}

/**
 * 创建 mock AI Link 数据
 */
export function createMockAiLinkData(overrides: Partial<AiLinkItem> = {}): AiLinkItem {
  return {
    ai_link_id: 'test-link-1',
    name: 'Test AI Tool',
    description: 'A test AI tool for testing',
    logo: 'https://example.com/logo.png',
    url: 'https://example.com',
    group_id: 1,
    sort: 1,
    ...overrides,
  }
}

/**
 * 创建 mock 分组数据
 */
export function createMockGroupData(overrides: Partial<GroupOption> = {}): GroupOption {
  return {
    group_id: 1,
    group_name: 'Test Group',
    children: [],
    ...overrides,
  }
}

/**
 * 创建 mock AI Link API
 */
export function mockAiLinkApi() {
  const mockList = vi.fn()
  const mockSave = vi.fn()
  const mockDelete = vi.fn()
  const mockStore = vi.fn()
  const mockSort = vi.fn()
  const mockDetail = vi.fn()

  const api = {
    list: mockList.mockResolvedValue([]),
    save: mockSave.mockResolvedValue({ ai_link_id: 'new-id', name: 'New Tool' }),
    delete: mockDelete.mockResolvedValue(undefined),
    store: mockStore.mockResolvedValue({ data: [] }),
    sort: mockSort.mockResolvedValue(undefined),
    detail: mockDetail.mockResolvedValue({ data: {} }),
  }

  vi.mock('@/api/modules/ai-link', () => ({
    aiLinkApi: api,
    default: api,
  }))

  return {
    api,
    mocks: {
      list: mockList,
      save: mockSave,
      delete: mockDelete,
      store: mockStore,
      sort: mockSort,
      detail: mockDetail,
    },
  }
}

/**
 * 创建 mock Group API
 */
export function mockGroupApi() {
  const mockList = vi.fn()

  const api = {
    list: mockList.mockResolvedValue([
      { group_id: 1, group_name: 'Group 1' },
      { group_id: 2, group_name: 'Group 2' },
    ]),
  }

  vi.mock('@/api/modules/group', () => ({
    default: api,
  }))

  return {
    api,
    mocks: {
      list: mockList,
    },
  }
}

/**
 * 创建完整的 API mock 环境
 */
export function setupApiMocks() {
  const aiLinkApi = mockAiLinkApi()
  const groupApi = mockGroupApi()

  return {
    aiLinkApi,
    groupApi,
    resetAll: () => {
      Object.values(aiLinkApi.mocks).forEach((mock) => mock.mockClear())
      Object.values(groupApi.mocks).forEach((mock) => mock.mockClear())
    },
  }
}

/**
 * 创建模拟响应数据
 */
export function createMockResponse<T>(data: T, delay = 0) {
  return new Promise<T>((resolve) => {
    if (delay > 0) {
      setTimeout(() => resolve(data), delay)
    } else {
      resolve(data)
    }
  })
}

/**
 * 创建模拟错误响应
 */
export function createMockError(message: string, status = 500) {
  return Promise.reject(new Error(`HTTP Error ${status}: ${message}`))
}
