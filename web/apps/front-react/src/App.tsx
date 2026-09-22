import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { useUserStore } from './stores/modules/user'
import { useEnterpriseStore } from './stores/modules/enterprise'
import { LoginModal } from './components/LoginModal'
import { CaptchaModal } from '@km/shared-business/captcha'
import commonApi from '@/api/modules/common'
import { t } from '@/locales'
import { ExpireModal } from './components/ExpireModal'
import { ChangePasswordModal } from './components/ChangePasswordModal'
import { Upgrade } from './components/Upgrade'
import { PermissionApplyProvider } from './contexts/PermissionApplyContext'
import { router } from './router'
import { eventBus } from '@km/shared-utils'
import { EVENT_NAMES } from './constants/events'
import { fetchPasswordStrength, resetPasswordPolicyCache } from './hooks/usePasswordPolicy'

export function App() {
  const userStore = useUserStore()
  const enterpriseStore = useEnterpriseStore()

  useEffect(() => {
    // Load enterprise info on mount
    enterpriseStore.loadInfo()

    // Check login status
    const token = localStorage.getItem('access_token')
    if (token) {
      userStore.getUserInfo(false)
    }

    // Listen for login success events
    eventBus.on(EVENT_NAMES.LOGIN_SUCCESS, () => {
      checkSubscriptionExpire()
      // 登录后企业上下文可能已变，密码策略需重新获取
      resetPasswordPolicyCache()
      void fetchPasswordStrength()
    })

    // Handle WeChat login callback
    const search = new URLSearchParams(window.location.search)
    if (search.get('login_way') === 'wechat_login') {
      // Handle WeChat login - will be implemented in LoginModal
    }
  }, [])

  const checkSubscriptionExpire = async () => {
    // TODO: Implement subscription expiry check
  }

  return (
    <PermissionApplyProvider>
      <LoginModal />
      <CaptchaModal fetchCaptcha={() => commonApi.getCaptcha()} t={t} />
      <ExpireModal />
      <ChangePasswordModal />
      <Upgrade />
      <RouterProvider router={router} />
    </PermissionApplyProvider>
  )
}
