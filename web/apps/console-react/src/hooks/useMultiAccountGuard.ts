import { useEffect, useRef, useCallback } from 'react'
import { useUserStore } from '@/stores/modules/user'
import { useEnterpriseStore } from '@/stores/modules/enterprise'
import { Modal } from 'antd'
import { watchAccountConflict, type AccountIdentity } from '@km/shared-utils'

/**
 * 多账号登录状态冲突检测
 */
export function useMultiAccountGuard() {
  const userStore = useUserStore()
  const enterpriseStore = useEnterpriseStore()
  const cleanupRef = useRef<(() => void) | null>(null)
  const modalShownRef = useRef(false)

  const getCurrentIdentity = useCallback((): AccountIdentity => ({
    eid: userStore.info.eid as string | number,
    user_id: userStore.info.user_id as string,
    nickname: userStore.info.nickname as string,
    username: userStore.info.username as string,
  }), [userStore.info.eid, userStore.info.user_id, userStore.info.nickname, userStore.info.username])

  const getCurrentEnterpriseName = useCallback(() =>
    enterpriseStore.info.name || '', [enterpriseStore.info.name])

  const onTokenChanged = useCallback(async (): Promise<AccountIdentity | null> => {
    try {
      await userStore.loadSelfInfo()
      const state = useUserStore.getState()
      return {
        eid: state.info.eid as string | number,
        user_id: state.info.user_id as string,
        nickname: state.info.nickname as string,
        username: state.info.username as string,
      }
    } catch {
      return null
    }
  }, [userStore])

  const onAccountConflict = useCallback((oldIdentity: AccountIdentity, newIdentity: AccountIdentity, oldEnterprise: string) => {
    if (modalShownRef.current) return
    modalShownRef.current = true

    const oldUserName = oldIdentity.nickname || oldIdentity.username || ''
    const newUserName = newIdentity.nickname || newIdentity.username || ''

    Modal.warning({
      title: '账号已切换',
      content: `检测到您在其他标签页登录了新账号「${newUserName}」，当前页面显示的仍是「${oldUserName}（${oldEnterprise}）」的数据。为避免数据错乱，页面将自动刷新。`,
      okText: '立即刷新',
      onOk: () => window.location.reload(),
    })

    setTimeout(() => window.location.reload(), 3000)
  }, [])

  const onTokenRemoved = useCallback(() => {
    window.location.reload()
  }, [])

  useEffect(() => {
    if (!userStore.info.access_token) return

    cleanupRef.current = watchAccountConflict({
      getCurrentIdentity,
      getCurrentEnterpriseName,
      onTokenChanged,
      onTokenRemoved,
      onAccountConflict,
    })

    return () => {
      cleanupRef.current?.()
    }
  }, [userStore.info.access_token, getCurrentIdentity, getCurrentEnterpriseName, onTokenChanged, onTokenRemoved, onAccountConflict])
}

export default useMultiAccountGuard
