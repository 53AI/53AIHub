/**
 * 测试工具导出入口
 * 统一导出所有测试工具函数
 */

// React Testing Library
export { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'

// 自定义 render 函数
export { renderWithRouter, renderWithStore, createMockNavigate, createMockSearchParams } from './render'

// Router mock 工具
export {
  mockUseNavigate,
  mockUseSearchParams,
  mockUseLocation,
  mockUseParams,
  createRouterMocks,
} from './mockRouter'

// Store mock 工具
export {
  createMockStore,
  mockEnterpriseStore,
  mockUserStore,
  clearStoreMocks,
} from './mockStore'

// API mock 工具
export {
  createMockAiLinkData,
  createMockGroupData,
  mockAiLinkApi,
  mockGroupApi,
  setupApiMocks,
  createMockResponse,
  createMockError,
} from './mockApi'

// 类型导出
export type { render as RenderFunction } from '@testing-library/react'
