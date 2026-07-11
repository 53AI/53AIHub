import { isHashRouter } from '@/router/index'

/**
 * Router utility functions
 */

/**
 * 根据路由模式组装完整 URL
 * @param path 路径，例如 '/share/file/123'
 * @param params 可选的查询参数
 * @returns 根据路由模式返回完整的 URL 格式
 *   - hash 路由: 'https://example.com#/share/file/123'
 *   - history 路由: 'https://example.com/share/file/123'
 */
export function buildUrl(path: string, params?: Record<string, any>): string {
  // 确保路径以 / 开头
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  // 构建查询参数
  let fullPath = normalizedPath
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        searchParams.append(key, String(value))
      }
    })
    const queryString = searchParams.toString()
    if (queryString) {
      fullPath = `${normalizedPath}?${queryString}`
    }
  }

  // 添加协议和域名
  return `${window.location.origin}${isHashRouter ? `#${fullPath}` : fullPath}`
}

/**
 * Parse query string to object
 */
export function parseQuery(queryString: string): Record<string, string> {
  const params = new URLSearchParams(queryString)
  const result: Record<string, string> = {}
  params.forEach((value, key) => {
    result[key] = value
  })
  return result
}

/**
 * Set router query parameters (for hash router)
 * 仅用于设置 hash 参数，不包含 origin
 */
export function setRouterQuery(params: Record<string, any>, basePath: string = '/'): void {
  const normalizedPath = basePath.startsWith('/') ? basePath : `/${basePath}`

  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      searchParams.append(key, String(value))
    }
  })

  const queryString = searchParams.toString()
  const hashPath = normalizedPath + (queryString ? `?${queryString}` : '')
  window.location.hash = hashPath
}

/**
 * Get current query parameters
 */
export function getQueryParams(): Record<string, string> {
  const search = window.location.search || window.location.hash.split('?')[1] || ''
  return parseQuery(search)
}

/**
 * Navigate to a URL
 */
export function navigate(url: string, replace: boolean = false): void {
  if (replace) {
    window.history.replaceState(null, '', url)
  } else {
    window.history.pushState(null, '', url)
  }
  // Dispatch popstate event for router to pick up
  window.dispatchEvent(new PopStateEvent('popstate'))
}
