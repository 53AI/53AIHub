/**
 * Permission utility functions
 */
import { message } from 'antd'
import { useUserStore } from '@/stores/modules/user'
import { t } from '@/locales'
import resourceScopesApi from '@/api/modules/resource-scopes'
import type { ResourceType } from '@/api/modules/resource-scopes'

export interface AuthOptions {
  // 检测是不是登录
  checkLogin?: boolean
  // 检测是不是有权限（已废弃，使用 resourceId + resourceType 代替）
  checkVersion?: boolean
  // 需要的权限组ID（已废弃）
  groupIds?: number[]
  // 检测是不是内部用户
  checkInternal?: boolean
  // 资源ID（HashID）
  resourceId?: string | number
  // 资源类型
  resourceType?: ResourceType
  // 通过检查后的回调
  onClick?: () => void
  // 检查失败的回调
  onFailed?: () => void
}

/**
 * 显示登录弹窗
 */
export const showLoginModal = (): void => {
  window.dispatchEvent(new CustomEvent('open-login-modal'))
}

/**
 * 显示升级弹窗
 */
export const showUpgradeModal = (): void => {
  window.dispatchEvent(new CustomEvent('open-upgrade-modal'))
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  return !!localStorage.getItem('access_token')
}

/**
 * 检查登录状态
 */
export const checkLoginStatus = (): boolean => {
  const isLogined = isLoggedIn()
  if (!isLogined) {
    showLoginModal()
    return false
  }
  return true
}

/**
 * 检查版本权限（旧逻辑，用于外部用户）
 * @deprecated 内部用户请使用 checkScopePermissionAsync
 */
export const checkVersionPermission = (groupIds?: number[]): boolean => {
  if (!groupIds || groupIds.length === 0) return true

  const userStore = useUserStore.getState()
  const userGroupIds = userStore.info.group_ids || (userStore.info.group_id ? [userStore.info.group_id] : [])
  const isInternal = userStore.info.is_internal
  const hasPermission = Boolean(
    userGroupIds.length && groupIds.some((id) => userGroupIds.includes(id))
  )

  if (!hasPermission) {
    if (isInternal) {
      message.warning(t('authority.agent_not_permission'))
      return false
    }
    showUpgradeModal()
    return false
  }

  return true
}

/**
 * 检查内部用户权限
 */
export const checkInternalPermission = (): boolean => {
  const userStore = useUserStore.getState()
  const isInternal = userStore.info.is_internal
  if (isInternal) {
    return true
  }
  message.warning(t('authority.knowledge_not_permission'))
  return false
}

/**
 * 异步检查资源权限（内部用户使用新接口）
 * @param resourceId 资源ID（HashID）
 * @param resourceType 资源类型：agent | space | library
 * @returns 用户是否有权限访问该资源
 */
export const checkScopePermissionAsync = async (
  resourceId: string | number,
  resourceType: ResourceType
): Promise<boolean> => {
  const userStore = useUserStore.getState()
  const isInternal = userStore.info.is_internal

  // 内部用户使用新接口检查权限
  if (isInternal) {
    const hasPermission = await resourceScopesApi.check({
      resource_id: resourceId,
      resource_type: resourceType,
    })
    if (!hasPermission) {
      message.warning(t('authority.agent_not_permission'))
    }
    return hasPermission
  }

  // 外部用户：如果没有 resourceId，返回 true（不限制）
  // 如果需要检查版本权限，这里返回 true，由调用方处理
  return true
}

/**
 * 统一的认证检查函数（同步版本）
 * @param options 认证选项
 * @returns 是否通过认证
 * @deprecated 推荐使用 checkPermissionAsync
 */
export const checkPermission = (options: AuthOptions = {}): boolean => {
  const { groupIds, onClick, onFailed, checkInternal } = options

  // 检查登录状态
  if (!checkLoginStatus()) {
    onFailed?.()
    return false
  }

  // 检查版本权限
  if (!checkVersionPermission(groupIds)) {
    onFailed?.()
    return false
  }

  // 检查内部权限
  if (checkInternal && !checkInternalPermission()) {
    onFailed?.()
    return false
  }

  // 如果所有检查都通过，执行回调
  onClick?.()

  return true
}

/**
 * 统一的认证检查函数（异步版本）
 * @param options 认证选项
 * @returns 是否通过认证
 */
export const checkPermissionAsync = async (options: AuthOptions = {}): Promise<boolean> => {
  const { groupIds, onClick, onFailed, checkInternal, resourceId, resourceType } = options

  // 检查登录状态
  if (!checkLoginStatus()) {
    onFailed?.()
    return false
  }

  const userStore = useUserStore.getState()
  const isInternal = userStore.info.is_internal

  // 内部用户 + 有 resourceId：使用新接口检查权限
  if (isInternal && resourceId && resourceType) {
    const hasPermission = await checkScopePermissionAsync(resourceId, resourceType)
    if (!hasPermission) {
      onFailed?.()
      return false
    }
  } else if (groupIds && groupIds.length > 0) {
    // 旧逻辑：通过 groupIds 检查
    if (!checkVersionPermission(groupIds)) {
      onFailed?.()
      return false
    }
  }

  // 检查内部权限
  if (checkInternal && !checkInternalPermission()) {
    onFailed?.()
    return false
  }

  // 如果所有检查都通过，执行回调
  onClick?.()

  return true
}

/**
 * Get current user info from localStorage
 */
export function getCurrentUser(): any {
  const userInfo = localStorage.getItem('user_info')
  return userInfo ? JSON.parse(userInfo) : null
}

/**
 * Require authentication for a route
 */
export function requireAuth(redirectUrl?: string): boolean {
  if (!isLoggedIn()) {
    const event = new CustomEvent('open-login-modal', {
      detail: { redirectUrl }
    })
    window.dispatchEvent(event)
    return false
  }
  return true
}
