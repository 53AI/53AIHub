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

/**
 * 构造 Wiki 页面跳转 URL（统一在所有调用点使用，避免参数漂移）
 *
 * 输出形如：`{origin}/knowledge/wiki?space_id=xxx&sub=list&selected=yyy&vd-type=dynamicKnowledge`
 *
 * @param spaceId 空间 ID（必填；空字符串会被丢弃以保持 URL 干净）
 * @param slug 页面 slug（必填）
 */
export function buildWikiPageUrl(spaceId: string, slug: string): string {
  const search = new URLSearchParams()
  if (spaceId) search.set('space_id', spaceId)
  search.set('sub', 'list')
  search.set('selected', slug)
  search.set('vd-type', 'dynamicKnowledge')
  return buildUrl(`/knowledge/wiki?${search.toString()}`)
}

/**
 * 构造知识库文件跳转 URL（统一在所有调用点使用，避免参数漂移）
 *
 * 输出形如：`{origin}/library/{libraryId}/file/{fileId}?vd-type=knowledge[&chunk={chunkId}]`
 *
 * 返回带 origin 的完整 URL，与 `buildWikiPageUrl` 保持一致，方便直接用于
 * `<a href>`、`navigate`、`window.open` 等。
 *
 * @param libraryId 知识库 ID（必填）
 * @param fileId 文件 ID（必填）
 * @param chunkId 可选的 chunk ID
 */
export function buildKnowledgeFileUrl(
  libraryId: string,
  fileId: string,
  chunkId?: string,
  isFolder?: boolean
): string {
  const search = new URLSearchParams()
  search.set('vd-type', 'knowledge')
  if (chunkId) search.set('chunk', chunkId)
  const query = search.toString()
  return buildUrl(`/library/${encodeURIComponent(libraryId)}/${isFolder ? 'folder' : 'file'}/${encodeURIComponent(fileId)}${query ? `?${query}` : ''}`)
}
