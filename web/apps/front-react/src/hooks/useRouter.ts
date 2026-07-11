import { useNavigate, useLocation, generatePath } from 'react-router-dom'

interface RouteConfig {
  path: string
  params?: Record<string, string | number>
  query?: Record<string, string | number>
}

// 路由名称映射
const routeNames: Record<string, string> = {
  'Home': '/',
  'Index': '/index',
  'Chat': '/chat',
  'Agent': '/agent',
  'Toolkit': '/toolkit',
  'Prompt': '/prompt',
  'PromptDetail': '/prompt/:prompt_id',
  'Knowledge': '/knowledge',
  'KnowledgeSpace': '/knowledge/:space_id',
  'Order': '/order',
  'Mine': '/mine',
  'Profile': '/profile',
  'Library': '/library/:id',
  'LibraryHome': '/library/:id/home',
  'LibraryFile': '/library/:id/file/:fileId',
  'LibrarySetting': '/library/:id/setting',
  'Guide': '/guide',
}

/**
 * 路由导航 Hook
 */
export function useRouter() {
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * 导航到指定路由名称
   */
  const navigateTo = (name: string, options?: { params?: Record<string, string | number>, query?: Record<string, string | number> }) => {
    let path = routeNames[name] || name
    
    if (options?.params) {
      path = generatePath(path, options.params as Record<string, string>)
    }
    
    if (options?.query) {
      const queryString = new URLSearchParams(
        Object.entries(options.query).map(([k, v]) => [k, String(v)])
      ).toString()
      path = `${path}?${queryString}`
    }
    
    navigate(path)
  }

  /**
   * 获取路由名称对应的路径
   */
  const getRoutePath = (name: string, params?: Record<string, string | number>): string => {
    let path = routeNames[name] || name
    if (params) {
      path = generatePath(path, params as Record<string, string>)
    }
    return path
  }

  /**
   * 获取当前路由名称
   */
  const getRouteName = (): string | undefined => {
    const currentPath = location.pathname
    for (const [name, path] of Object.entries(routeNames)) {
      // 简单匹配，不支持动态路由
      if (path === currentPath) {
        return name
      }
    }
    return undefined
  }

  /**
   * 返回上一页
   */
  const goBack = () => {
    navigate(-1)
  }

  /**
   * 前进
   */
  const goForward = () => {
    navigate(1)
  }

  /**
   * 替换当前路由
   */
  const replace = (path: string) => {
    navigate(path, { replace: true })
  }

  return {
    navigate: navigateTo,
    push: navigate,
    replace,
    goBack,
    goForward,
    getRoutePath,
    getRouteName,
    currentPath: location.pathname,
    location
  }
}

export default useRouter