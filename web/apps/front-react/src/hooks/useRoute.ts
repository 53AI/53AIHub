import { useParams, useLocation, useSearchParams } from 'react-router-dom'

/**
 * 获取路由参数
 */
export function useRouteParams<T = Record<string, string>>(): T {
  const params = useParams()
  return params as T
}

/**
 * 获取查询参数
 */
export function useQueryParams<T = Record<string, string>>(): T {
  const [searchParams] = useSearchParams()
  const result: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    result[key] = value
  })
  return result as T
}

/**
 * 获取当前路径
 */
export function useCurrentPath(): string {
  const location = useLocation()
  return location.pathname
}

/**
 * 获取完整路由信息
 */
export function useRoute() {
  const params = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  return {
    params,
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    searchParams: Object.fromEntries(searchParams.entries())
  }
}

export default useRoute