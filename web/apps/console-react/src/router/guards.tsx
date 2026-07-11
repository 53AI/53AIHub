import type { PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spin } from 'antd'
import { useEnterpriseStore, useUserStore } from '@/stores'

const AUTH_FREE_PATHS = new Set(['/login', '/register'])

function isOpLocalEnv(): boolean {
  return (import.meta.env.VITE_PLATFORM as string | undefined) === 'op-local'
}

function isPrivatePremEnv(): boolean {
  return (import.meta.env.VITE_PRIVATE_PREM as string | undefined) === 'true'
}

export function gotoLogin(): void {
  // 复用 /console 的登录重定向逻辑
  let loginUrl = ''

  if (!loginUrl) {
    loginUrl = `//${window.location.host}${window.location.search}`
    if (/(127.0.0.1)|(localhost)|(agenthubdev.cc)|(192.168.1.\d+)|/.test(loginUrl)) {
      loginUrl = `//${window.location.host}/console/saas-login/index.html${window.location.search}`
    }
  }

  if (isOpLocalEnv() || isPrivatePremEnv()) {
    loginUrl = `${window.location.origin}/#/index`
  }

  window.location.replace(loginUrl)
}

export function RequireAuth(props: PropsWithChildren) {
  const location = useLocation()
  const enterpriseStore = useEnterpriseStore()

  const isInvalidUser = !localStorage.getItem('access_token')
  const isAuthFree = AUTH_FREE_PATHS.has(location.pathname)
  const pathname = location.pathname

  // 对齐 Vue: 检测到无 token 时执行一次 logoff。使用 getState() 避免订阅 store，防止 logoff 触发的状态更新导致 effect 循环
  useEffect(() => {
    if (isInvalidUser) {
      useUserStore.getState().logoff()
    }
  }, [isInvalidUser])

  if (!isAuthFree && isInvalidUser) {
    gotoLogin()
    return null
  }

  // 对齐 Vue beforeEach：针对 RegisterUser / InternalUser 的企业类型校验
  const isRegisterUserPath = pathname === '/user/register'
  const isInternalUserPath = pathname === '/user/internal'
  const needsEnterpriseCheck = isRegisterUserPath || isInternalUserPath

  // 跟踪企业信息是否已加载完成（对齐 Vue 的 await 行为）
  const [enterpriseLoaded, setEnterpriseLoaded] = useState(false)

  useEffect(() => {
    if (!isInvalidUser && needsEnterpriseCheck) {
      const { info, loadSelfInfo } = useEnterpriseStore.getState()
      // 使用 is_loading 判断企业信息是否已加载：
      // - 初始状态：is_loading = undefined（getInitialInfo 未设置）
      // - 加载完成后：is_loading = false（loadSelfInfo 设置）
      if (info.is_loading === false) {
        // 已加载完成，直接标记为已加载
        setEnterpriseLoaded(true)
      } else {
        // 需要加载企业信息，完成后标记为已加载
        loadSelfInfo().then(() => {
          setEnterpriseLoaded(true)
        })
      }
    } else {
      // 不需要企业信息检查的路径，直接标记为已加载
      setEnterpriseLoaded(true)
    }
  }, [isInvalidUser, needsEnterpriseCheck])

  // 等待企业信息加载完成后再进行权限检查（对齐 Vue 的 await 行为）
  if (!enterpriseLoaded) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Spin size="large" />
      </div>
    )
  }

  if (!isInvalidUser && needsEnterpriseCheck) {
    const info = enterpriseStore.info

    const isRegisterBlocked =
      isRegisterUserPath && !info.is_independent && !info.is_industry
    const isInternalBlocked =
      isInternalUserPath && !info.is_enterprise && !info.is_industry

    if (isRegisterBlocked || isInternalBlocked) {
      return <Navigate to="/404" replace />
    }
  }

  if (isAuthFree && !isInvalidUser && location.pathname !== '/login') {
    return <Navigate to="/index" replace />
  }

  return <>{props.children}</>
}

