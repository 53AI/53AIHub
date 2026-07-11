/**
 * Zustand Store mock 工具
 * 用于测试中 mock Zustand store
 */
import { vi } from 'vitest'

/**
 * 创建 mock store 工厂函数
 */
export function createMockStore<T extends object>(defaultState: T) {
  let state = { ...defaultState }

  return {
    getState: () => state,
    setState: (newState: Partial<T> | ((prev: T) => T)) => {
      if (typeof newState === 'function') {
        state = newState(state)
      } else {
        state = { ...state, ...newState }
      }
    },
    reset: () => {
      state = { ...defaultState }
    },
  }
}

/**
 * Mock useEnterpriseStore
 */
export function mockEnterpriseStore(overrides: Partial<{
  info: {
    id: string
    eid: string
    is_independent: boolean
    is_industry: boolean
    is_enterprise: boolean
    name: string
    logo: string
  }
}> = {}) {
  const defaultState = {
    info: {
      id: 'test-enterprise',
      eid: 'test-eid',
      is_independent: false,
      is_industry: false,
      is_enterprise: true,
      name: 'Test Enterprise',
      logo: 'https://example.com/logo.png',
      ...overrides.info,
    },
    version: {
      product_id: 1,
      name: '创业版',
      version: 1,
      features: {},
    },
    getFormatEnterpriseData: vi.fn((data) => data),
    loadListData: vi.fn(),
    apply: vi.fn(),
    loadDetailData: vi.fn(),
    loadSelfInfo: vi.fn(),
    loadHomeInfo: vi.fn(),
    update: vi.fn(),
    loadVersionInfo: vi.fn(),
    loadLicenseVersionInfo: vi.fn(),
    loadSMTPInfo: vi.fn(),
    loadSMTPDetail: vi.fn(),
    saveSMTPInfo: vi.fn(),
    sendTestEmail: vi.fn(),
  }

  vi.mock('@/stores/modules/enterprise', () => ({
    useEnterpriseStore: vi.fn(() => defaultState),
  }))

  return defaultState
}

/**
 * Mock useUserStore
 */
export function mockUserStore(overrides: Partial<{
  userInfo: {
    id: string
    name: string
    email: string
  }
}> = {}) {
  const defaultState = {
    userInfo: {
      id: 'test-user',
      name: 'Test User',
      email: 'test@example.com',
      ...overrides.userInfo,
    },
    setAccessToken: vi.fn(),
    setEid: vi.fn(),
    setIsSaasLogin: vi.fn(),
  }

  vi.mock('@/stores/modules/user', () => ({
    useUserStore: vi.fn(() => defaultState),
  }))

  return defaultState
}

/**
 * 清除所有 store mocks
 */
export function clearStoreMocks() {
  vi.unmock('@/stores/modules/enterprise')
  vi.unmock('@/stores/modules/user')
}
