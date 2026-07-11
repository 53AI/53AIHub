/**
 * 多账号登录冲突检测 - 核心逻辑
 *
 * 场景：Tab A 登录账号 A → Tab B 登录账号 B（覆盖 localStorage token）
 *       → 用户回到 Tab A 操作，实际使用账号 B 的 token
 *
 * 此模块提供核心检测逻辑，React Hook 层在各自项目中实现
 */

const TOKEN_KEY = 'access_token'

export interface AccountIdentity {
  eid: string | number
  user_id: string
  nickname?: string
  username?: string
}

export interface OnAccountConflict {
  (oldAccount: AccountIdentity, newAccount: AccountIdentity, oldEnterprise: string): void
}

export interface OnTokenRemoved {
  (): void
}

/**
 * 创建 storage 事件监听器
 *
 * @param getCurrentIdentity - 获取当前用户身份的函数
 * @param onTokenChanged - token 变化后的回调（用于验证新身份）
 * @param onTokenRemoved - token 被删除的回调（其他标签页登出）
 * @returns 清理函数
 */
export function watchAccountConflict(options: {
  onTokenChanged: () => Promise<AccountIdentity | null>
  onTokenRemoved: OnTokenRemoved
  onAccountConflict: OnAccountConflict
  getCurrentIdentity: () => AccountIdentity
  getCurrentEnterpriseName: () => string
}): () => void {
  const {
    onTokenChanged,
    onTokenRemoved,
    onAccountConflict,
    getCurrentIdentity,
    getCurrentEnterpriseName,
  } = options

  // 初始化当前身份基准（用于后续比对）
  const currentIdentity = getCurrentIdentity()
  let lastEid: string | number = currentIdentity.eid
  let lastUserId: string = currentIdentity.user_id
  let modalShown = false

  const handleStorageChange = async (e: StorageEvent) => {
    if (e.key !== TOKEN_KEY) return

    const newToken = e.newValue

    // token 被删除（其他标签页登出）
    if (!newToken) {
      onTokenRemoved()
      return
    }

    // token 变化（其他标签页登录了新账号）
    try {
      const newIdentity = await onTokenChanged()
      if (!newIdentity) return

      const eidChanged = String(newIdentity.eid) !== String(lastEid)
      const userIdChanged = newIdentity.user_id !== lastUserId

      if (eidChanged || userIdChanged) {
        if (!modalShown) {
          modalShown = true
          const oldIdentity = getCurrentIdentity()
          const oldEnterprise = getCurrentEnterpriseName()
          onAccountConflict(oldIdentity, newIdentity, oldEnterprise)
        }
      } else {
        // 同一用户重新登录（token 刷新）
        lastEid = newIdentity.eid
        lastUserId = newIdentity.user_id
      }
    } catch (error) {
      console.error('[MultiAccountGuard] 验证身份失败:', error)
    }
  }

  window.addEventListener('storage', handleStorageChange)

  return () => {
    window.removeEventListener('storage', handleStorageChange)
  }
}

export default {
  watchAccountConflict,
}
