import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isOpLocalEnv, isPrivatePrem } from '@/utils/config'
import { systemApi } from '@/api/modules/system'

interface InitGuardProps {
  children: React.ReactNode
}

export function InitGuard({ children }: InitGuardProps) {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    // 非本地版/私有化环境，直接放行
    if (!isOpLocalEnv && !isPrivatePrem) {
      setStatus('ready')
      return
    }

    const isGuidePath = location.pathname === '/guide'

    // 检查初始化状态
    systemApi.init()
      .then(res => {
        const isInitialized = res.data === true

        if (!isInitialized && !isGuidePath) {
          // 未初始化 -> 引导页
          navigate('/guide', { replace: true })
        } else if (isInitialized && isGuidePath) {
          // 已初始化但在引导页 -> 首页
          navigate('/index', { replace: true })
        }
      })
      .catch(() => {
        // 接口失败时放行，避免阻塞
      })
      .finally(() => {
        setStatus('ready')
      })
  }, [location.pathname])

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center w-full h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return <>{children}</>
}

export default InitGuard
