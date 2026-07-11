/**
 * React Router mock 工具
 * 用于测试中 mock 路由相关 hooks
 */
import { vi } from 'vitest'
import React from 'react'

/**
 * Mock useNavigate hook
 */
export function mockUseNavigate(returnValue?: ReturnType<typeof vi.fn>) {
  const navigate = returnValue || vi.fn()
  vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>()
    return {
      ...actual,
      useNavigate: () => navigate,
    }
  })
  return navigate
}

/**
 * Mock useSearchParams hook
 */
export function mockUseSearchParams(
  initialParams: Record<string, string> = {},
): [URLSearchParams, ReturnType<typeof vi.fn>] {
  const searchParams = new URLSearchParams(initialParams)
  const setSearchParams = vi.fn((newParams: URLSearchParams | Record<string, string> | string) => {
    if (typeof newParams === 'string') {
      searchParams.set('search', newParams)
    } else if (newParams instanceof URLSearchParams) {
      newParams.forEach((value, key) => searchParams.set(key, value))
    } else {
      Object.entries(newParams).forEach(([key, value]) => searchParams.set(key, value))
    }
  })
  vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>()
    return {
      ...actual,
      useSearchParams: () => [searchParams, setSearchParams] as const,
    }
  })
  return [searchParams, setSearchParams]
}

/**
 * Mock useLocation hook
 */
export function mockUseLocation(
  location: Partial<ReturnType<typeof import('react-router-dom').useLocation>> = {},
) {
  const defaultLocation = {
    pathname: '/',
    search: '',
    hash: '',
    state: null,
    key: 'default',
    ...location,
  }
  vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>()
    return {
      ...actual,
      useLocation: () => defaultLocation,
    }
  })
  return defaultLocation
}

/**
 * Mock useParams hook
 */
export function mockUseParams(params: Record<string, string> = {}) {
  vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>()
    return {
      ...actual,
      useParams: () => params,
    }
  })
  return params
}

/**
 * 创建完整的 Router mock
 */
export function createRouterMocks(options: {
  navigate?: ReturnType<typeof vi.fn>
  searchParams?: Record<string, string>
  location?: Partial<ReturnType<typeof import('react-router-dom').useLocation>>
  params?: Record<string, string>
} = {}) {
  const navigate = options.navigate || vi.fn()
  const searchParams = new URLSearchParams(options.searchParams || {})
  const setSearchParams = vi.fn()
  const location = {
    pathname: '/',
    search: '',
    hash: '',
    state: null,
    key: 'default',
    ...options.location,
  }
  const params = options.params || {}

  return {
    navigate,
    searchParams,
    setSearchParams,
    location,
    params,
    mockRouter: () => {
      vi.mock('react-router-dom', async (importOriginal) => {
        const actual = await importOriginal<typeof import('react-router-dom')>()
        return {
          ...actual,
          useNavigate: () => navigate,
          useSearchParams: () => [searchParams, setSearchParams] as const,
          useLocation: () => location,
          useParams: () => params,
        }
      })
    },
  }
}
