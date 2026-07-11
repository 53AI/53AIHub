/**
 * 测试工具函数
 * 提供自定义 render 函数和常用测试工具
 */
import React, { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, MemoryRouterProps } from 'react-router-dom'
import { vi } from 'vitest'

// 重新导出 testing-library 所有内容
export * from '@testing-library/react'
export { render }

/**
 * 路由包装器 Props
 */
interface RouterWrapperProps {
  children: React.ReactNode
  initialEntries?: MemoryRouterProps['initialEntries']
  initialIndex?: MemoryRouterProps['initialIndex']
}

/**
 * 创建带路由的包装器组件
 */
function createRouterWrapper(options: { initialEntries?: string[]; initialIndex?: number } = {}) {
  return function RouterWrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={options.initialEntries} initialIndex={options.initialIndex}>
        {children}
      </MemoryRouter>
    )
  }
}

/**
 * 自定义 render 函数，包含常用 providers
 */
function customRender(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { routerOptions?: { initialEntries?: string[]; initialIndex?: number } } = {},
) {
  const { routerOptions, ...renderOptions } = options

  const Wrapper = createRouterWrapper(routerOptions)

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

/**
 * 带 store mock 的 render 函数
 */
interface StoreMockOptions {
  [storeName: string]: Record<string, unknown>
}

function renderWithStore(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & {
    routerOptions?: { initialEntries?: string[]; initialIndex?: number }
    storeMocks?: StoreMockOptions
  } = {},
) {
  const { routerOptions, storeMocks, ...renderOptions } = options

  // 如果有 store mocks，可以在这里注入
  // 当前先使用简单的路由包装
  const Wrapper = createRouterWrapper(routerOptions)

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

/**
 * 创建 mock 导航函数
 */
function createMockNavigate() {
  return vi.fn()
}

/**
 * 创建 mock 搜索参数
 */
function createMockSearchParams(params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(params)
  return [
    searchParams,
    vi.fn((newParams: URLSearchParams | Record<string, string>) => {
      if (newParams instanceof URLSearchParams) {
        return
      }
      Object.entries(newParams).forEach(([key, value]) => {
        searchParams.set(key, value)
      })
    }),
  ] as const
}

export { customRender as renderWithRouter, renderWithStore, createMockNavigate, createMockSearchParams }
