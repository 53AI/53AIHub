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
import { NicknamePrompt } from './components/NicknamePrompt'
import { Upgrade } from './components/Upgrade'
import { PermissionApplyProvider } from './contexts/PermissionApplyContext'
import { router } from './router'
import { eventBus } from '@km/shared-utils'
import { EVENT_NAMES } from './constants/events'
import { fetchPasswordStrength, resetPasswordPolicyCache } from './hooks/usePasswordPolicy'
import { useVersionReload } from './hooks/useVersionReload'
import { useRecordingStore } from './stores/modules/recording'
import { useNotificationStore } from './stores/modules/notification'

export function App() {
  const userStore = useUserStore()
  const enterpriseStore = useEnterpriseStore()
  const recordingStatus = useRecordingStore((s) => s.status)
  const isLogin = userStore.is_login

  // 部署版本自愈：检测到新版本自动刷新（录音中跳过，结束后下轮再试）
  useVersionReload(() => recordingStatus !== 'idle')

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

  // 未读消息统计轮询：登录即启动、登出即停止，与页面/布局分支无关（侧边栏头像红点常驻）
  useEffect(() => {
    const { start, stop } = useNotificationStore.getState()
    if (isLogin) {
      start()
    } else {
      stop()
    }
  }, [isLogin])

  const checkSubscriptionExpire = async () => {
    // TODO: Implement subscription expiry check
  }

  return (
    <PermissionApplyProvider>
      <LoginModal />
      <CaptchaModal fetchCaptcha={() => commonApi.getCaptcha()} t={t} />
      <ExpireModal />
      <ChangePasswordModal />
      <NicknamePrompt />
      <Upgrade />
      <RouterProvider router={router} />
    </PermissionApplyProvider>
  )
}
