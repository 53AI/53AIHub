import { useParams } from 'react-router-dom'

/**
 * 获取路由参数 Hook
 * 用法: const { id, space_id } = useRouteParams<{ id: string; space_id: string }>()
 */
export function useRouteParams<T = Record<string, string>>(): T {
  const params = useParams()
  return params as T
}

export default useRouteParams